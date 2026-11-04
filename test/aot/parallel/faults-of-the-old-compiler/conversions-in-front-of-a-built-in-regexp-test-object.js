const later = what => ({ toString() { console.log(what + " asked"); throw new RangeError(what); }, valueOf() { console.log(what + " asked"); throw new RangeError(what); } });
try { console.log(String(/a+/.test(later("text")))); } catch (e) { console.log(e.name, e.message); }
