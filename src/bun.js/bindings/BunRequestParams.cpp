#include "BunRequestParams.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/URLParser.h>
#include <wtf/URL.h>
#include <wtf/text/StringToIntegerConversion.h>

namespace Bun {

using namespace JSC;

// Helper to check if a string represents a valid array index (non-negative integer)
static bool isArrayIndex(const String& key, unsigned& index)
{
    if (key.isEmpty())
        return false;

    // Check if all characters are digits
    for (auto c : StringView(key).codeUnits()) {
        if (!isASCIIDigit(c))
            return false;
    }

    // Parse the integer
    auto parseResult = parseInteger<unsigned>(StringView(key));
    if (!parseResult.has_value())
        return false;

    index = parseResult.value();

    // Prevent creating huge sparse arrays - limit to reasonable size
    // Rails typically limits array indices to prevent DoS
    // We'll use a high limit that prevents obvious abuse
    if (index > 10000)
        return false;

    return true;
}

// Helper function to parse Rails-style query parameters into nested objects
// Returns false if an exception was thrown
static bool parseRailsStyleParams(JSC::JSGlobalObject* globalObject, JSC::JSObject* result, const String& key, const String& value)
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    // Find the first bracket
    size_t bracketPos = key.find('[');

    // No brackets - simple key-value pair
    if (bracketPos == notFound) {
        // Ignore __proto__ for security
        if (key == "__proto__"_s)
            return true;

        // Simple key-value assignment - last value wins
        // Use putDirectMayBeIndex since key could be numeric
        result->putDirectMayBeIndex(globalObject, Identifier::fromString(vm, key), jsString(vm, value));
        RETURN_IF_EXCEPTION(throwScope, false);
        return true;
    }

    // Extract the base key
    String baseKey = key.substring(0, bracketPos);
    if (baseKey == "__proto__"_s)
        return true;

    // Parse the rest of the key to determine structure
    String remainder = key.substring(bracketPos);

    // Get existing value at baseKey
    JSValue existing = result->getDirect(vm, Identifier::fromString(vm, baseKey));

    // Handle [] notation (array append)
    if (remainder.startsWith("[]"_s)) {
        JSArray* array = nullptr;

        // Check if we already have a value at this key
        if (!existing.isEmpty()) {
            if (!existing.isObject())
                return true; // Can't convert primitive to array

            JSObject* obj = asObject(existing);
            if (!obj->inherits<JSArray>())
                return true; // Type conflict - it's an object, not an array

            array = jsCast<JSArray*>(obj);
        } else {
            // Create new array
            array = JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), 0);
            result->putDirect(vm, Identifier::fromString(vm, baseKey), array);
            RETURN_IF_EXCEPTION(throwScope, false);
        }

        // Check if there's more nesting after []
        if (remainder.length() > 2 && remainder[2] == '[') {
            // Handle cases like users[][name] - create object and recursively parse
            String nestedRemainder = remainder.substring(2);

            // Create a new object for this array element
            JSObject* nestedObj = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
            array->putDirectIndex(globalObject, array->length(), nestedObj);
            RETURN_IF_EXCEPTION(throwScope, false);

            // Recursively parse the nested structure
            // Remove the leading [ and find the closing ]
            size_t closeBracket = nestedRemainder.find(']');
            if (closeBracket != notFound) {
                String nestedKey = nestedRemainder.substring(1, closeBracket - 1);
                String afterBracket = closeBracket + 1 < nestedRemainder.length()
                    ? nestedRemainder.substring(closeBracket + 1)
                    : String();

                if (afterBracket.isEmpty()) {
                    // Simple nested property like users[][name]
                    if (nestedKey != "__proto__"_s) {
                        // Use putDirectMayBeIndex since nestedKey could be empty or numeric
                        nestedObj->putDirectMayBeIndex(globalObject, Identifier::fromString(vm, nestedKey), jsString(vm, value));
                        RETURN_IF_EXCEPTION(throwScope, false);
                    }
                } else {
                    // More complex nesting like users[][address][street]
                    String fullNestedKey = makeString(nestedKey, afterBracket);
                    if (!parseRailsStyleParams(globalObject, nestedObj, fullNestedKey, value))
                        return false;
                }
            }
        } else {
            // Simple array append - users[]=value
            array->putDirectIndex(globalObject, array->length(), jsString(vm, value));
            RETURN_IF_EXCEPTION(throwScope, false);
        }
        return true;
    }

    // Handle [key] notation (could be array index or object property)
    size_t closeBracket = remainder.find(']');
    if (closeBracket == notFound)
        return true; // Malformed

    String innerKey = remainder.substring(1, closeBracket - 1);

    // Determine if this should be an array (numeric index) or object (string key)
    unsigned index = 0;
    bool isIndex = isArrayIndex(innerKey, index);

    // Get or create the container (array or object)
    JSObject* container = nullptr;
    bool isArray = false;

    if (!existing.isEmpty()) {
        if (!existing.isObject())
            return true; // Can't index into primitive

        container = asObject(existing);
        isArray = container->inherits<JSArray>();

        // Type consistency check
        if (isIndex && !isArray)
            return true; // Trying to use array index on object
        if (!isIndex && isArray)
            return true; // Trying to use string key on array
    } else {
        // Create new container based on the key type
        if (isIndex) {
            container = JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), 0);
            isArray = true;
        } else {
            container = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
            isArray = false;
        }
        result->putDirect(vm, Identifier::fromString(vm, baseKey), container);
        RETURN_IF_EXCEPTION(throwScope, false);
    }

    // Check if there's more nesting
    size_t nextBracket = remainder.find('[', closeBracket + 1);
    if (nextBracket != notFound) {
        // More nesting - recursively parse
        String nestedRemainder = remainder.substring(closeBracket + 1);

        // Get or create nested object
        JSObject* nestedObj = nullptr;

        if (isArray) {
            JSArray* array = jsCast<JSArray*>(container);
            JSValue existingAtIndex = index < array->length() ? array->getIndexQuickly(index) : JSValue();

            if (!existingAtIndex.isEmpty() && existingAtIndex.isObject()) {
                nestedObj = asObject(existingAtIndex);
            } else {
                nestedObj = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
                array->putDirectIndex(globalObject, index, nestedObj);
                RETURN_IF_EXCEPTION(throwScope, false);
            }
        } else {
            // Skip __proto__ for security
            if (innerKey == "__proto__"_s)
                return true;

            JSValue existingNested = container->getDirect(vm, Identifier::fromString(vm, innerKey));

            if (!existingNested.isEmpty() && existingNested.isObject()) {
                nestedObj = asObject(existingNested);
            } else {
                nestedObj = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
                // Use putDirectMayBeIndex since innerKey could be numeric
                container->putDirectMayBeIndex(globalObject, Identifier::fromString(vm, innerKey), nestedObj);
                RETURN_IF_EXCEPTION(throwScope, false);
            }
        }

        // Parse the nested structure
        if (nestedRemainder.startsWith("["_s) && nestedRemainder.length() > 1) {
            size_t endBracket = nestedRemainder.find(']');
            if (endBracket != notFound) {
                String propertyName = nestedRemainder.substring(1, endBracket - 1);
                String afterProperty = endBracket + 1 < nestedRemainder.length()
                    ? nestedRemainder.substring(endBracket + 1)
                    : String();

                if (afterProperty.isEmpty()) {
                    // Simple property assignment
                    if (propertyName != "__proto__"_s) {
                        // Use putDirectMayBeIndex since propertyName could be empty or numeric
                        nestedObj->putDirectMayBeIndex(globalObject, Identifier::fromString(vm, propertyName), jsString(vm, value));
                        RETURN_IF_EXCEPTION(throwScope, false);
                    }
                } else {
                    // More complex nesting
                    String fullNestedKey = makeString(propertyName, afterProperty);
                    if (!parseRailsStyleParams(globalObject, nestedObj, fullNestedKey, value))
                        return false;
                }
            }
        }
    } else {
        // No more nesting - assign the value
        if (isArray) {
            JSArray* array = jsCast<JSArray*>(container);
            array->putDirectIndex(globalObject, index, jsString(vm, value));
            RETURN_IF_EXCEPTION(throwScope, false);
        } else {
            // Skip __proto__ for security
            if (innerKey != "__proto__"_s) {
                // Use putDirectMayBeIndex since innerKey could be numeric
                container->putDirectMayBeIndex(globalObject, Identifier::fromString(vm, innerKey), jsString(vm, value));
                RETURN_IF_EXCEPTION(throwScope, false);
            }
        }
    }
    return true;
}

JSObject* parseQueryParams(JSGlobalObject* globalObject, const String& queryString)
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    // Create result object with null prototype for security
    JSObject* queryObject = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());

    if (queryString.isEmpty()) {
        return queryObject;
    }

    // Parse query string using WebKit's URLParser
    auto params = WTF::URLParser::parseURLEncodedForm(queryString);

    // Process each parameter with Rails-style parsing
    for (const auto& param : params) {
        if (!parseRailsStyleParams(globalObject, queryObject, param.key, param.value)) {
            RETURN_IF_EXCEPTION(throwScope, nullptr);
        }
    }

    return queryObject;
}

JSObject* parseURLQueryParams(JSGlobalObject* globalObject, const String& urlString)
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    // Parse the URL to extract query string
    URL url(urlString);
    StringView queryView = url.query();
    String queryString = queryView.toString();

    JSObject* result = parseQueryParams(globalObject, queryString);
    RETURN_IF_EXCEPTION(throwScope, nullptr);
    return result;
}

// Export for testing
JSC_DEFINE_HOST_FUNCTION(jsBunParseQueryParams, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    
    // parseQueryParams might return nullptr if an exception occurred
    if (!result) {
        return JSValue::encode(jsUndefined());
    }
    
    return JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue Bun__parseQueryParams(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    return jsBunParseQueryParams(globalObject, callFrame);
}

} // namespace Bun
