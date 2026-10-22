/(n)(a)/.exec("banana");
console.log(RegExp.$1.length, RegExp.$2, RegExp.$3.length, RegExp.lastMatch, RegExp.leftContext, RegExp.rightContext, RegExp.input.length);
