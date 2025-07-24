#include "root.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include "ZigGlobalObject.h"
#include "helpers.h"
#include "wtf-bindings.h"

using namespace JSC;

namespace Bun {

static String escapeYAMLString(const String& str)
{
    // Check if string needs quoting
    bool needsQuotes = false;
    
    // YAML reserved words and numeric strings
    if (str == "true"_s || str == "false"_s || str == "null"_s || str == "~"_s ||
        str == "yes"_s || str == "no"_s || str == "on"_s || str == "off"_s) {
        needsQuotes = true;
    }
    
    // Check if string looks like a number
    if (!needsQuotes && !str.isEmpty()) {
        bool isNumeric = true;
        bool hasDot = false;
        for (unsigned i = 0; i < str.length(); i++) {
            auto ch = str[i];
            if (i == 0 && (ch == '-' || ch == '+')) {
                continue; // Allow leading sign
            }
            if (ch == '.' && !hasDot) {
                hasDot = true;
                continue;
            }
            if (ch < '0' || ch > '9') {
                isNumeric = false;
                break;
            }
        }
        if (isNumeric) {
            needsQuotes = true;
        }
    }
    
    // Check for leading/trailing whitespace or internal spaces
    if (!str.isEmpty()) {
        if (str[0] == ' ' || str[str.length()-1] == ' ') {
            needsQuotes = true;
        }
        // Check for internal spaces when used as keys (this is a simplified check)
        for (unsigned i = 0; i < str.length(); i++) {
            if (str[i] == ' ') {
                needsQuotes = true;
                break;
            }
        }
    }
    
    // Check for special characters
    for (unsigned i = 0; i < str.length(); i++) {
        auto ch = str[i];
        if (ch == '"' || ch == '\n' || ch == '\r' || ch == '\t' || ch == '\\' ||
            ch == ':' || ch == '[' || ch == ']' || ch == '{' || ch == '}' ||
            ch == '#' || ch == '&' || ch == '*' || ch == '!' || ch == '|' ||
            ch == '>' || ch == '\'' || ch == '%' || ch == '@' || ch == '`') {
            needsQuotes = true;
            break;
        }
    }
    
    if (!needsQuotes) {
        return str;
    }
    
    // Escape and quote the string
    StringBuilder result;
    result.append('"');
    
    for (unsigned i = 0; i < str.length(); i++) {
        auto ch = str[i];
        switch (ch) {
        case '"':
            result.append("\\\""_s);
            break;
        case '\\':
            result.append("\\\\"_s);
            break;
        case '\n':
            result.append("\\n"_s);
            break;
        case '\r':
            result.append("\\r"_s);
            break;
        case '\t':
            result.append("\\t"_s);
            break;
        default:
            result.append(ch);
        }
    }
    
    result.append('"');
    return result.toString();
}

// Forward declarations
static String serializeYAMLValue(JSGlobalObject* globalObject, JSValue value, unsigned indent, HashMap<JSObject*, unsigned>& objectMap, unsigned& anchorCounter, HashSet<JSObject*>& visitedForCircular);

// Pre-pass to detect circular references
static void detectCircularReferences(JSGlobalObject* globalObject, JSValue value, HashSet<JSObject*>& visiting, HashSet<JSObject*>& circular)
{
    if (!value.isObject()) {
        return;
    }
    
    JSObject* object = value.getObject();
    
    if (visiting.contains(object)) {
        circular.add(object);
        return;
    }
    
    if (circular.contains(object)) {
        return;
    }
    
    visiting.add(object);
    
    if (value.inherits<JSArray>()) {
        JSArray* array = jsCast<JSArray*>(object);
        auto length = array->length();
        for (unsigned i = 0; i < length; i++) {
            JSValue element = array->getIndex(globalObject, i);
            detectCircularReferences(globalObject, element, visiting, circular);
        }
    } else {
        auto& vm = globalObject->vm();
        PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        object->getOwnNonIndexPropertyNames(globalObject, propertyNames, DontEnumPropertiesMode::Exclude);
        
        for (auto& propertyName : propertyNames) {
            JSValue propValue = object->get(globalObject, propertyName);
            detectCircularReferences(globalObject, propValue, visiting, circular);
        }
    }
    
    visiting.remove(object);
}

static String serializeYAMLArray(JSGlobalObject* globalObject, JSArray* array, unsigned indent, HashMap<JSObject*, unsigned>& objectMap, unsigned& anchorCounter, HashSet<JSObject*>& visitedForCircular)
{
    auto length = array->length();
    
    if (length == 0) {
        return String("[]"_s);
    }
    
    StringBuilder result;
    StringBuilder indentBuilder;
    for (unsigned i = 0; i < indent; i++) {
        indentBuilder.append(' ');
    }
    String indentStr = indentBuilder.toString();
    
    for (unsigned i = 0; i < length; i++) {
        if (i > 0) {
            result.append('\n');
        }
        result.append(indentStr);
        result.append("- "_s);
        
        JSValue element = array->getIndex(globalObject, i);
        String serializedElement = serializeYAMLValue(globalObject, element, indent + 2, objectMap, anchorCounter, visitedForCircular);
        
        if (element.inherits<JSArray>() && !serializedElement.startsWith("*"_s)) {
            // For nested arrays, we want: "- - first_element\n  - second_element\n  ..."
            // The serializedElement comes with indentation, we need to restructure it
            auto lines = serializedElement.split('\n');
            if (lines.size() > 0) {
                // First line should become "- first_element" (removing leading spaces and first dash)
                String firstLine = lines[0];
                unsigned trimStart = 0;
                while (trimStart < firstLine.length() && firstLine[trimStart] == ' ') {
                    trimStart++;
                }
                // Should now be at "- element", we want just "- element"
                result.append(firstLine.substring(trimStart));
                
                // Subsequent lines should be indented to align under the first element
                for (size_t lineIdx = 1; lineIdx < lines.size(); lineIdx++) {
                    result.append('\n');
                    result.append(indentStr);
                    result.append("  "_s); // Align with the content after "- "
                    
                    String line = lines[lineIdx];
                    // Remove the original indentation
                    unsigned lineTrimStart = 0;
                    while (lineTrimStart < line.length() && line[lineTrimStart] == ' ') {
                        lineTrimStart++;
                    }
                    result.append(line.substring(lineTrimStart));
                }
            }
        } else if (element.isObject() && !serializedElement.startsWith("*"_s)) {
            // Objects should have their first property on the same line as "- "
            // and subsequent properties indented to align with the first
            auto lines = serializedElement.split('\n');
            if (lines.size() > 0) {
                // First line should be after "- " with no extra indentation
                String firstLine = lines[0];
                // Remove leading whitespace since we already have "- "
                unsigned trimStart = 0;
                while (trimStart < firstLine.length() && firstLine[trimStart] == ' ') {
                    trimStart++;
                }
                result.append(firstLine.substring(trimStart));
                
                // Subsequent lines should be indented to align with the start of the first property
                for (size_t lineIdx = 1; lineIdx < lines.size(); lineIdx++) {
                    result.append('\n');
                    result.append(indentStr);
                    result.append("  "_s); // Align with the content after "- "
                    
                    String line = lines[lineIdx];
                    // Remove the original indentation since we're adding our own
                    unsigned lineTrimStart = 0;
                    while (lineTrimStart < line.length() && line[lineTrimStart] == ' ') {
                        lineTrimStart++;
                    }
                    result.append(line.substring(lineTrimStart));
                }
            }
        } else {
            result.append(serializedElement);
        }
    }
    
    return result.toString();
}

static String serializeYAMLObject(JSGlobalObject* globalObject, JSObject* object, unsigned indent, HashMap<JSObject*, unsigned>& objectMap, unsigned& anchorCounter, HashSet<JSObject*>& visitedForCircular)
{
    auto& vm = globalObject->vm();
    
    PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->getOwnNonIndexPropertyNames(globalObject, propertyNames, DontEnumPropertiesMode::Exclude);
    
    if (propertyNames.size() == 0) {
        return String("{}"_s);
    }
    
    StringBuilder result;
    StringBuilder indentBuilder;
    for (unsigned i = 0; i < indent; i++) {
        indentBuilder.append(' ');
    }
    String indentStr = indentBuilder.toString();
    bool first = true;
    
    for (auto& propertyName : propertyNames) {
        if (!first) {
            result.append('\n');
        }
        first = false;
        
        result.append(indentStr);
        String keyStr = propertyName.string();
        result.append(escapeYAMLString(keyStr));
        result.append(": "_s);
        
        JSValue value = object->get(globalObject, propertyName);
        String serializedValue = serializeYAMLValue(globalObject, value, indent + 2, objectMap, anchorCounter, visitedForCircular);
        
        if (value.isObject() && (value.inherits<JSArray>() || value.inherits<JSObject>())) {
            if (serializedValue.startsWith("*"_s)) {
                // For aliases, keep them on the same line
                result.append(serializedValue);
            } else {
                result.append('\n');
                result.append(serializedValue);
            }
        } else {
            result.append(serializedValue);
        }
    }
    
    return result.toString();
}

static String serializeYAMLValue(JSGlobalObject* globalObject, JSValue value, unsigned indent, HashMap<JSObject*, unsigned>& objectMap, unsigned& anchorCounter, HashSet<JSObject*>& visitedForCircular)
{
    auto& vm = globalObject->vm();
    
    if (value.isNull()) {
        return String("null"_s);
    }
    
    if (value.isUndefined()) {
        return String("null"_s);  // YAML doesn't have undefined, use null
    }
    
    if (value.isBoolean()) {
        return String(value.asBoolean() ? "true"_s : "false"_s);
    }
    
    if (value.isNumber()) {
        double num = value.asNumber();
        if (std::isnan(num)) {
            return String(".nan"_s);
        }
        if (std::isinf(num)) {
            return num > 0 ? String(".inf"_s) : String("-.inf"_s);
        }
        return String::number(num);
    }
    
    if (value.isString()) {
        return escapeYAMLString(value.toWTFString(globalObject));
    }
    
    if (value.inherits<DateInstance>()) {
        auto* dateInstance = jsCast<DateInstance*>(value);
        double timeValue = dateInstance->internalNumber();
        if (std::isnan(timeValue)) {
            return String("null"_s);
        }
        char buffer[64];
        size_t length = toISOString(vm, timeValue, buffer);
        return String::fromUTF8(std::span<const char>(buffer, length));
    }
    
    if (value.isObject()) {
        JSObject* object = value.getObject();
        
        // Check for circular references
        auto it = objectMap.find(object);
        if (it != objectMap.end()) {
            // Already seen this object, use alias
            StringBuilder alias;
            alias.append("*anchor"_s);
            alias.append(String::number(it->value));
            return alias.toString();
        }
        
        // Only add anchors for objects that are actually circular
        if (visitedForCircular.contains(object)) {
            objectMap.set(object, ++anchorCounter);
            
            StringBuilder anchor;
            anchor.append("&anchor"_s);
            anchor.append(String::number(anchorCounter));
            anchor.append(' ');
            
            if (value.inherits<JSArray>()) {
                anchor.append(serializeYAMLArray(globalObject, jsCast<JSArray*>(object), indent, objectMap, anchorCounter, visitedForCircular));
            } else {
                anchor.append(serializeYAMLObject(globalObject, object, indent, objectMap, anchorCounter, visitedForCircular));
            }
            
            return anchor.toString();
        } else {
            if (value.inherits<JSArray>()) {
                return serializeYAMLArray(globalObject, jsCast<JSArray*>(object), indent, objectMap, anchorCounter, visitedForCircular);
            } else {
                return serializeYAMLObject(globalObject, object, indent, objectMap, anchorCounter, visitedForCircular);
            }
        }
    }
    
    return String("null"_s);
}

JSC_DEFINE_HOST_FUNCTION(yamlStringify, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "YAML.stringify requires at least 1 argument"_s);
        return JSValue::encode(jsUndefined());
    }
    
    JSValue value = callFrame->uncheckedArgument(0);
    
    // First pass: detect circular references
    HashSet<JSObject*> visiting;
    HashSet<JSObject*> circular;
    detectCircularReferences(globalObject, value, visiting, circular);
    
    // Second pass: serialize with circular reference handling
    HashMap<JSObject*, unsigned> objectMap;
    unsigned anchorCounter = 0;
    
    String result = serializeYAMLValue(globalObject, value, 0, objectMap, anchorCounter, circular);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());
    
    return JSValue::encode(jsString(vm, result));
}

JSValue constructYAMLObject(VM& vm, JSObject* bunObject)
{
    JSGlobalObject* globalObject = bunObject->globalObject();
    JSObject* yamlObject = constructEmptyObject(globalObject);
    
    yamlObject->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "stringify"_s), 1, yamlStringify, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | 0);
    
    return yamlObject;
}

} // namespace Bun