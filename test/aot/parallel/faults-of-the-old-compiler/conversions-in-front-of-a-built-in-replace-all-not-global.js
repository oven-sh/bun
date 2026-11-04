const later = what => ({ toString() { console.log(what + " asked"); throw new RangeError(what); }, valueOf() { console.log(what + " asked"); throw new RangeError(what); } });
try { console.log(String("abc".replaceAll(/a/, later("replacement")))); } catch (e) { console.log(e.name, e.message); }
