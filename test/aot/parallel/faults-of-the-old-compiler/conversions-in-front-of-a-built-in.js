try { new RegExp(Symbol(), { toString() { throw new RangeError("from flags"); } }); } catch (e) { console.log(e.name); }
