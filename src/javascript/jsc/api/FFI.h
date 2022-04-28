// This is an auto-generated file
//
// clang-format off
// This file is only compatible with 64 bit CPUs
// It must be kept in sync with JSCJSValue.h
// https://github.com/Jarred-Sumner/WebKit/blob/72c2052b781cbfd4af867ae79ac9de460e392fba/Source/JavaScriptCore/runtime/JSCJSValue.h#L455-L458


#define IS_BIG_ENDIAN 0
#define USE_JSVALUE64 1
#define USE_JSVALUE32_64 0

/* 7.18.1.1  Exact-width integer types */
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef int64_t intptr_t;
typedef uint64_t uintptr_t;
typedef uintptr_t size_t;

#define true 1
#define false 0
#define bool _bool

// This value is 2^49, used to encode doubles such that the encoded value will
// begin with a 15-bit pattern within the range 0x0002..0xFFFC.
#define DoubleEncodeOffsetBit (size_t)(49)
#define DoubleEncodeOffset    (int64_t)(1ll << DoubleEncodeOffsetBit)
#define OtherTag              0x2
#define BoolTag               0x4
#define UndefinedTag          0x8
#define TagValueFalse            (OtherTag | BoolTag | false)
#define TagValueTrue             (OtherTag | BoolTag | true)
#define TagValueUndefined        (OtherTag | UndefinedTag)
#define TagValueNull             (OtherTag)

// If all bits in the mask are set, this indicates an integer number,
// if any but not all are set this value is a double precision number.
#define NumberTag 0xfffe000000000000ll

typedef  void* JSCell;

typedef union EncodedJSValue {
  int64_t asInt64;
#if USE_JSVALUE32_64
  double asDouble;
#elif USE_JSVALUE64
  JSCell *ptr;
#endif

#if IS_BIG_ENDIAN
  struct {
    int32_t tag;
    int32_t payload;
  } asBits;
#else
  struct {
    int32_t payload;
    int32_t tag;
  } asBits;
#endif

  void* asPtr;
} EncodedJSValue;

EncodedJSValue ValueUndefined = { TagValueUndefined };
EncodedJSValue ValueTrue = { TagValueTrue };


static EncodedJSValue INT32_TO_JSVALUE(int32_t val);
static EncodedJSValue INT32_TO_JSVALUE(int32_t val) {
   EncodedJSValue res;
   res.asInt64 = NumberTag | (uint32_t)val;
   return res;
}

#define JSVALUE_IS_TRUE(i) (!!(i.asInt64 == ValueTrue))
#define JSVALUE_TO_INT32(i) (int32_t)i.asInt64
#define JSVALUE_TO_DOUBLE(i) ((double)(i.asInt64 - DoubleEncodeOffset))
#define JSVALUE_TO_FLOAT(i) ((float)(i.asInt64 - DoubleEncodeOffset))

#define BOOLEAN_TO_JSVALUE(i) (i ? ValueTrue : ValueFalse)

#define DOUBLE_TO_JSVALUE(i) ((double)(i.asInt64 - DoubleEncodeOffset))
#define FLOAT_TO_JSVALUE(i) ((float)(i.asInt64 - DoubleEncodeOffset))




typedef void* JSContext;
typedef EncodedJSValue* JSException;


// typedef void* (^ArrayBufferLikeGetPtrFunction)(JSContext, EncodedJSValue);
// static ArrayBufferLikeGetPtrFunction JSArrayBufferGetPtr = (ArrayBufferLikeGetPtrFunction)MEMORY_ADDRESS_FOR_GET_ARRAY_BUFFER_FUNCTION;
// (*JSObjectCallAsFunctionCallback) (JSContextRef ctx, JSObjectRef function, JSObjectRef thisObject, size_t argumentCount, const JSValueRef arguments[], JSValueRef* exception);

// This is an example of a function which does the bare minimum
void* Bun__CallbackFunctionPlaceholder(JSContext ctx, EncodedJSValue function, EncodedJSValue thisObject, size_t argumentCount, const EncodedJSValue arguments[], JSException exception);
void* Bun__CallbackFunctionPlaceholder(JSContext ctx, EncodedJSValue function, EncodedJSValue thisObject, size_t argumentCount, const EncodedJSValue arguments[], JSException exception) {
    return (void*)123;
}
