// What Object lists once three functions of the library have run. It lists a member from when it is first read, and a copy adds all that
// nobody has read yet behind those. The members that the program reads itself stand between those that the library reads.
// Whoever changes that on purpose writes the new order here. A name that is not in the stored order is passed over.
const stored =
  "length,name,prototype,hasOwn,groupBy,freeze,create,defineProperty,is,defineProperties,isFrozen,getPrototypeOf,assign,setPrototypeOf,getOwnPropertyDescriptor,values,keys,entries,getOwnPropertyDescriptors,getOwnPropertyNames,getOwnPropertySymbols,seal,preventExtensions,isSealed,isExtensible,fromEntries";
process.nextTick(() => {});
Object.is(1, 1);
const { AsyncResource } = require("node:async_hooks");
AsyncResource.bind(() => {});
Object.isFrozen({});
const socket = require("node:dgram").createSocket("udp4");
socket.bind(0, "127.0.0.1", () => {
  socket.close();
  Object.entries(Object);
  const known = stored.split(",");
  const order = Reflect.ownKeys(Object)
    .map(String)
    .filter(key => known.includes(key))
    .join();
  console.log(order);
  if (order !== stored) {
    console.log("stored:", stored);
    process.exit(1);
  }
});
