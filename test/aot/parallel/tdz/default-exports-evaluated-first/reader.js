import numberValue from "./number.js";
import negativeNumberValue from "./negative-number.js";
import stringValue from "./string.js";
import templateValue from "./template.js";
import templateWithValueValue from "./template-with-value.js";
import booleanValue from "./boolean.js";
import nullValue from "./null.js";
import undefinedValue from "./undefined.js";
import bigIntValue from "./big-int.js";
import arrowValue from "./arrow.js";
import functionExpressionValue from "./function-expression.js";
import classExpressionValue from "./class-expression.js";
import derivedClassExpressionValue from "./derived-class-expression.js";
import classExpressionWithCallValue from "./class-expression-with-call.js";
import nameValue from "./name.js";
import callValue from "./call.js";
import objectValue from "./object.js";
import arrayValue from "./array.js";
import regularExpressionValue from "./regular-expression.js";
import importMetaValue from "./import-meta.js";
import sumValue from "./sum.js";
import anonymousClassValue from "./anonymous-class.js";
import namedClassValue from "./named-class.js";
import derivedClassValue from "./derived-class.js";
import classWithStaticBlockValue from "./class-with-static-block.js";
import anonymousFunctionValue from "./anonymous-function.js";
import asyncFunctionValue from "./async-function.js";
import generatorValue from "./generator.js";
function read(name) {
  switch (name) {
    case "number": return numberValue;
    case "negative-number": return negativeNumberValue;
    case "string": return stringValue;
    case "template": return templateValue;
    case "template-with-value": return templateWithValueValue;
    case "boolean": return booleanValue;
    case "null": return nullValue;
    case "undefined": return undefinedValue;
    case "big-int": return bigIntValue;
    case "arrow": return arrowValue;
    case "function-expression": return functionExpressionValue;
    case "class-expression": return classExpressionValue;
    case "derived-class-expression": return derivedClassExpressionValue;
    case "class-expression-with-call": return classExpressionWithCallValue;
    case "name": return nameValue;
    case "call": return callValue;
    case "object": return objectValue;
    case "array": return arrayValue;
    case "regular-expression": return regularExpressionValue;
    case "import-meta": return importMetaValue;
    case "sum": return sumValue;
    case "anonymous-class": return anonymousClassValue;
    case "named-class": return namedClassValue;
    case "derived-class": return derivedClassValue;
    case "class-with-static-block": return classWithStaticBlockValue;
    case "anonymous-function": return anonymousFunctionValue;
    case "async-function": return asyncFunctionValue;
    case "generator": return generatorValue;
  }
}
export function report(time, name) {
  try {
    console.log(time, name, typeof read(name));
  } catch (error) {
    console.log(time, name, error.name);
  }
}
