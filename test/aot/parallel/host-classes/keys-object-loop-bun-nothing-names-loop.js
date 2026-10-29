// A for-in loop over `Bun` asks whether its first key is there. Nothing in the program names that member. Then a rest pattern copies Object, and its own keys are listed.
// Alone: the order of the keys follows from which members were read first, and the other programs of a joined executable read some
for (const key in Bun) break;
const { assign, ...rest } = Object;
console.log(Reflect.ownKeys(Object).join());
/* Output:
length,name,prototype,hasOwn,groupBy,assign,getPrototypeOf,setPrototypeOf,getOwnPropertyDescriptor,getOwnPropertyDescriptors,getOwnPropertyNames,getOwnPropertySymbols,keys,defineProperty,defineProperties,create,seal,freeze,preventExtensions,isSealed,isFrozen,isExtensible,is,values,entries,fromEntries
*/
