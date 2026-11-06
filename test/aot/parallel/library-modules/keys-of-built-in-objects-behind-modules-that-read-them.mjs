// What built-in objects list once modules of the library are loaded. An object lists a member from when it is first read, and a copy adds
// all that nobody has read yet behind those: the order tells which members the modules read while they load, and in which order.
// Whoever changes that on purpose writes the new order here. A name that is not in the stored order is passed over.
import "node:path";
import "node:path/posix";
import "node:path/win32";
import "node:stream";
import "node:stream/promises";
import "node:zlib";
import "node:tty";
import "node:net";
import "node:tls";
import "node:http";
import "node:https";
import "node:http2";
import "undici";
import "node:inspector";
import "node:inspector/promises";
import "node:util";
import "node:sys";
import "node:crypto";
import "node:readline";
import "node:readline/promises";
import "node:repl";

let allAsStored = true;
function show(name, holder, stored) {
  Object.entries(holder);
  const known = stored.split(",");
  const order = Reflect.ownKeys(holder)
    .map(String)
    .filter(key => known.includes(key))
    .join();
  console.log(name, order);
  if (order !== stored) {
    console.log("  stored:", stored);
    allAsStored = false;
  }
}

show(
  "Object",
  Object,
  "length,name,prototype,hasOwn,groupBy,freeze,create,defineProperty,keys,setPrototypeOf,getPrototypeOf,defineProperties,assign,getOwnPropertyDescriptor,values,entries,getOwnPropertyNames,getOwnPropertySymbols,is,seal,getOwnPropertyDescriptors,preventExtensions,isSealed,isFrozen,isExtensible,fromEntries",
);
show(
  "Reflect",
  Reflect,
  "getPrototypeOf,ownKeys,getOwnPropertyDescriptor,defineProperty,apply,construct,deleteProperty,get,has,isExtensible,preventExtensions,set,setPrototypeOf,Symbol(Symbol.toStringTag)",
);
show(
  "Buffer",
  Buffer,
  "length,name,prototype,poolSize,from,alloc,allocUnsafe,allocUnsafeSlow,byteLength,compare,concat,copyBytesFrom,isBuffer,isEncoding",
);
show("Array", Array, "length,name,prototype,of,isArray,fromAsync,from,Symbol(Symbol.species)");
show("BigInt", BigInt, "length,name,prototype,asUintN,asIntN");
show("BigInt.prototype", BigInt.prototype, "constructor,valueOf,toString,toLocaleString,Symbol(Symbol.toStringTag)");
show("Boolean.prototype", Boolean.prototype, "constructor,valueOf,toString");
show("Date", Date, "length,name,prototype,now,parse,UTC");
show(
  "Date.prototype",
  Date.prototype,
  "toUTCString,toGMTString,toTemporalInstant,constructor,getTime,toISOString,toString,toDateString,toTimeString,toLocaleString,toLocaleDateString,toLocaleTimeString,valueOf,getFullYear,getUTCFullYear,getMonth,getUTCMonth,getDate,getUTCDate,getDay,getUTCDay,getHours,getUTCHours,getMinutes,getUTCMinutes,getSeconds,getUTCSeconds,getMilliseconds,getUTCMilliseconds,getTimezoneOffset,getYear,setTime,setMilliseconds,setUTCMilliseconds,setSeconds,setUTCSeconds,setMinutes,setUTCMinutes,setHours,setUTCHours,setDate,setUTCDate,setMonth,setUTCMonth,setFullYear,setUTCFullYear,setYear,toJSON,Symbol(Symbol.toPrimitive)",
);
show("Error.prototype", Error.prototype, "name,message,constructor,toString");
show("JSON", JSON, "isRawJSON,rawJSON,stringify,parse,Symbol(Symbol.toStringTag)");
show(
  "Number",
  Number,
  "length,name,prototype,EPSILON,MAX_VALUE,MIN_VALUE,MAX_SAFE_INTEGER,MIN_SAFE_INTEGER,NEGATIVE_INFINITY,POSITIVE_INFINITY,NaN,parseInt,parseFloat,isInteger,isNaN,isFinite,isSafeInteger",
);
show(
  "Number.prototype",
  Number.prototype,
  "toString,constructor,valueOf,toFixed,toLocaleString,toExponential,toPrecision",
);
show(
  "Promise",
  Promise,
  "length,name,prototype,try,resolve,withResolvers,reject,race,all,allSettled,any,Symbol(Symbol.species)",
);
show("Promise.prototype", Promise.prototype, "then,catch,constructor,finally,Symbol(Symbol.toStringTag)");
show("String", String, "length,name,prototype,fromCharCode,fromCodePoint,raw");
show(
  "String.prototype",
  String.prototype,
  "length,toString,valueOf,charAt,charCodeAt,codePointAt,concat,indexOf,lastIndexOf,replace,replaceAll,repeat,padStart,padEnd,slice,substr,at,substring,toLowerCase,toUpperCase,localeCompare,toLocaleLowerCase,toLocaleUpperCase,trim,startsWith,endsWith,includes,match,search,matchAll,split,normalize,trimStart,trimLeft,trimEnd,trimRight,isWellFormed,toWellFormed,constructor,anchor,big,bold,blink,fixed,fontcolor,fontsize,italics,link,small,strike,sub,sup,Symbol(Symbol.iterator)",
);
show(
  "Symbol",
  Symbol,
  "length,name,prototype,hasInstance,isConcatSpreadable,asyncIterator,iterator,match,matchAll,replace,search,species,split,toPrimitive,toStringTag,unscopables,dispose,asyncDispose,for,keyFor",
);
show(
  "Symbol.prototype",
  Symbol.prototype,
  "constructor,toString,valueOf,description,Symbol(Symbol.toPrimitive),Symbol(Symbol.toStringTag)",
);
if (!allAsStored) process.exit(1);
