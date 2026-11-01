// The prototype objects of Crypto, SubtleCrypto, Timeout and Immediate list all their members, so the printer of console.log finds no method on them that nobody knows and util.inspect stays out.
// STATISTIC: ImageFunctionsEmitted <= 8
console.log(crypto);
console.log(crypto.subtle);
const timer = setTimeout(() => {}, 1);
const immediate = setImmediate(() => {});
console.log(timer);
console.log(immediate);
console.log(crypto.nothing, crypto.subtle.nothing, timer.nothing, immediate.nothing);
console.log("digest" in crypto.subtle, "subtle" in crypto, "refresh" in timer, "refresh" in immediate);
clearTimeout(timer);
clearImmediate(immediate);
