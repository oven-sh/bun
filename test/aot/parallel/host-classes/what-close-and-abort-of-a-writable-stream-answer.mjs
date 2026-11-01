// A promise of undefined, also where the stream is locked or the receiver is no stream: then it is rejected.
function closes() { return new WritableStream().close(); }
function aborts() { return new WritableStream().abort("why"); }
function locked() { const s = new WritableStream(); s.getWriter(); return s.close(); }
console.log(closes() instanceof Promise, await closes(), await aborts(), typeof closes().then);
try { await locked(); } catch (error) { console.log(error.name, error.code); }
try { await WritableStream.prototype.close.call({}); } catch (error) { console.log(error.name); }
