try { console.log(globalThis[["Func", "tion"].join("")]("return 6 * 7")()); } catch (e) { console.log(e.name); }
