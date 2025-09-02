#include "BunRequestParams.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/URLParser.h>
#include <wtf/URL.h>
#include <wtf/text/StringToIntegerConversion.h>

namespace Bun {

using namespace JSC;

// Helper function to parse Rails-style query parameters into nested objects
static void parseRailsStyleParams(JSC::JSGlobalObject* globalObject, JSC::JSObject* result, const String& key, const String& value)
{
    auto& vm = globalObject->vm();
    
    // Find the first bracket
    size_t bracketPos = key.find('[');
    
    // No brackets - simple key-value pair
    if (bracketPos == notFound) {
        // Check if key could be a number and handle it properly
        bool isNumeric = !key.isEmpty();
        for (auto c : StringView(key).codeUnits()) {
            if (!isASCIIDigit(c)) {
                isNumeric = false;
                break;
            }
        }
        
        if (isNumeric) {
            // Use putDirectMayBeIndex for numeric keys
            result->putDirectMayBeIndex(globalObject, Identifier::fromString(vm, key), jsString(vm, value));
        } else if (key == "__proto__"_s) {
            // Ignore __proto__ for security
            return;
        } else {
            result->putDirect(vm, Identifier::fromString(vm, key), jsString(vm, value));
        }
        return;
    }
    
    // Extract the base key
    String baseKey = key.substring(0, bracketPos);
    if (baseKey == "__proto__"_s) {
        // Ignore __proto__ for security
        return;
    }
    
    // Get or create the nested object/array
    JSValue existing = result->getDirect(vm, Identifier::fromString(vm, baseKey));
    JSObject* nested = nullptr;
    
    // Parse the rest of the key to determine structure
    String remainder = key.substring(bracketPos);
    
    // Check if it's an array notation []
    if (remainder.startsWith("[]"_s)) {
        // Array notation
        if (!existing.isEmpty() && existing.isObject()) {
            nested = asObject(existing);
            // Check if it's already an array
            if (!nested->inherits<JSArray>()) {
                // Type conflict - was object, now needs to be array
                // For now, skip this to avoid type errors
                return;
            }
        } else {
            // Create new array
            nested = JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), 0);
            result->putDirect(vm, Identifier::fromString(vm, baseKey), nested);
        }
        
        // Add value to array
        JSArray* array = jsCast<JSArray*>(nested);
        array->putDirectIndex(globalObject, array->length(), jsString(vm, value));
        
        // Handle nested properties after []
        size_t nextBracket = remainder.find('[', 2);
        if (nextBracket != notFound) {
            // Has more nesting after [] - not commonly supported in Rails
            // Skip for now
            return;
        }
    } else {
        // Object notation [key] or indexed array [0]
        size_t closeBracket = remainder.find(']');
        if (closeBracket == notFound) {
            // Malformed - skip
            return;
        }
        
        String innerKey = remainder.substring(1, closeBracket - 1);
        
        // Check if inner key is numeric (indexed array)
        bool isIndex = !innerKey.isEmpty();
        unsigned index = 0;
        if (isIndex) {
            for (auto c : StringView(innerKey).codeUnits()) {
                if (!isASCIIDigit(c)) {
                    isIndex = false;
                    break;
                }
            }
            if (isIndex) {
                // Parse as integer using StringView
                auto innerKeyView = StringView(innerKey);
                auto parseResult = parseInteger<unsigned>(innerKeyView);
                if (parseResult.has_value()) {
                    index = parseResult.value();
                } else {
                    isIndex = false;
                }
            }
        }
        
        if (isIndex) {
            // Indexed array notation [0], [1], etc.
            if (!existing.isEmpty() && existing.isObject()) {
                nested = asObject(existing);
                if (!nested->inherits<JSArray>()) {
                    // Type conflict
                    return;
                }
            } else {
                // Create new array
                nested = JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), 0);
                result->putDirect(vm, Identifier::fromString(vm, baseKey), nested);
            }
            
            JSArray* array = jsCast<JSArray*>(nested);
            
            // Check if there's more nesting
            size_t nextBracket = remainder.find('[', closeBracket + 1);
            if (nextBracket != notFound) {
                // More nesting - need to recursively parse
                String nestedKey = remainder.substring(closeBracket + 1);
                
                // Get or create object at index
                JSValue existingAtIndex = index < array->length() ? array->getIndexQuickly(index) : JSValue();
                JSObject* nestedObj = nullptr;
                
                if (!existingAtIndex.isEmpty() && existingAtIndex.isObject()) {
                    nestedObj = asObject(existingAtIndex);
                } else {
                    // Create object with null prototype for security
                    nestedObj = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
                    array->putDirectIndex(globalObject, index, nestedObj);
                }
                
                // Recursively parse the nested structure
                // Remove the leading bracket from nestedKey since it starts with [
                if (nestedKey.startsWith("["_s) && nestedKey.length() > 1) {
                    size_t endBracket = nestedKey.find(']');
                    if (endBracket != notFound) {
                        String propertyName = nestedKey.substring(1, endBracket - 1);
                        
                        // Check for more nesting after this property
                        String afterProperty = endBracket + 1 < nestedKey.length() ? nestedKey.substring(endBracket + 1) : String();
                        
                        if (afterProperty.isEmpty()) {
                            // Simple property assignment
                            if (propertyName != "__proto__"_s) {
                                nestedObj->putDirect(vm, Identifier::fromString(vm, propertyName), jsString(vm, value));
                            }
                        } else {
                            // More complex nesting
                            String fullNestedKey = makeString(propertyName, afterProperty);
                            parseRailsStyleParams(globalObject, nestedObj, fullNestedKey, value);
                        }
                    }
                }
            } else {
                // Simple indexed array value
                array->putDirectIndex(globalObject, index, jsString(vm, value));
            }
        } else {
            // Object key notation [key]
            if (!existing.isEmpty() && existing.isObject()) {
                nested = asObject(existing);
                if (nested->inherits<JSArray>()) {
                    // Type conflict - was array, now needs to be object
                    return;
                }
            } else {
                // Create object with null prototype for security
                nested = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
                result->putDirect(vm, Identifier::fromString(vm, baseKey), nested);
            }
            
            // Check if there's more nesting
            size_t nextBracket = remainder.find('[', closeBracket + 1);
            if (nextBracket != notFound) {
                // More nesting - recursively parse
                String nestedKey = makeString(innerKey, remainder.substring(closeBracket + 1));
                parseRailsStyleParams(globalObject, nested, nestedKey, value);
            } else {
                // Simple nested object value
                if (innerKey != "__proto__"_s) {
                    nested->putDirect(vm, Identifier::fromString(vm, innerKey), jsString(vm, value));
                }
            }
        }
    }
}

JSObject* parseQueryParams(JSGlobalObject* globalObject, const String& queryString)
{
    auto& vm = globalObject->vm();
    
    // Create result object with null prototype for security
    JSObject* queryObject = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    
    if (queryString.isEmpty()) {
        return queryObject;
    }
    
    // Parse query string using WebKit's URLParser
    auto params = WTF::URLParser::parseURLEncodedForm(queryString);
    
    // Process each parameter with Rails-style parsing
    for (const auto& param : params) {
        parseRailsStyleParams(globalObject, queryObject, param.key, param.value);
    }
    
    return queryObject;
}

JSObject* parseURLQueryParams(JSGlobalObject* globalObject, const String& urlString)
{
    // Parse the URL to extract query string
    URL url(urlString);
    StringView queryView = url.query();
    String queryString = queryView.toString();
    
    return parseQueryParams(globalObject, queryString);
}

// Export for testing
JSC_DEFINE_HOST_FUNCTION(jsBunParseQueryParams, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    if (callFrame->argumentCount() < 1) {
        return JSValue::encode(jsUndefined());
    }
    
    JSValue arg = callFrame->argument(0);
    if (!arg.isString()) {
        return JSValue::encode(jsUndefined());
    }
    
    String queryString = arg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    
    JSObject* result = parseQueryParams(globalObject, queryString);
    return JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue Bun__parseQueryParams(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) 
{
    return jsBunParseQueryParams(globalObject, callFrame);
}

} // namespace Bun