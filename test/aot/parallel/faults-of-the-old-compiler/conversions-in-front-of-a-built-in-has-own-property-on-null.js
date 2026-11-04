const later = what => ({ toString() { console.log(what + " asked"); throw new RangeError(what); }, valueOf() { console.log(what + " asked"); throw new RangeError(what); } });
try { console.log(String(Object.prototype.hasOwnProperty.call(null, later("key")))); } catch (e) { console.log(e.name, e.message); }
