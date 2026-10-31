const holders = {
  "Array.prototype": Array.prototype,
  "Request.prototype": Request.prototype,
  "Response.prototype": Response.prototype,
  "Headers.prototype": Headers.prototype,
  "Blob.prototype": Blob.prototype,
  "URL.prototype": URL.prototype,
  "URLSearchParams.prototype": URLSearchParams.prototype,
  "Promise.prototype": Promise.prototype,
  "RegExp.prototype": RegExp.prototype,
};
for (const [name, holder] of Object.entries(holders)) {
  const inherited = Object.getPrototypeOf(holder);
  let how = "changed";
  try {
    Object.setPrototypeOf(holder, {});
  } catch (error) {
    how = `${error.constructor.name}: ${error.message.split(" because ")[0]}`;
  }
  console.log(`${name}: ${how} | ${Reflect.setPrototypeOf(holder, {})} | ${Object.getPrototypeOf(holder) === inherited}`);
  Object.setPrototypeOf(holder, inherited);
}

/* Output:
Array.prototype: TypeError: Cannot change the prototype of Array.prototype | false | true
Request.prototype: TypeError: Cannot change the prototype of Request.prototype | false | true
Response.prototype: TypeError: Cannot change the prototype of Response.prototype | false | true
Headers.prototype: TypeError: Cannot change the prototype of Headers.prototype | false | true
Blob.prototype: TypeError: Cannot change the prototype of Blob.prototype | false | true
URL.prototype: TypeError: Cannot change the prototype of URL.prototype | false | true
URLSearchParams.prototype: TypeError: Cannot change the prototype of URLSearchParams.prototype | false | true
Promise.prototype: TypeError: Cannot change the prototype of Promise.prototype | false | true
RegExp.prototype: TypeError: Cannot change the prototype of RegExp.prototype | false | true
*/
