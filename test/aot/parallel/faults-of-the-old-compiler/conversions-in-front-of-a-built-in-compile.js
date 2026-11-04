const later = what => ({ toString() { console.log(what + " asked"); throw new RangeError(what); }, valueOf() { console.log(what + " asked"); throw new RangeError(what); } });
try { console.log(String(RegExp.prototype.compile.call(/a/, Symbol(), later("flags")))); } catch (e) { console.log(e.name, e.message); }
