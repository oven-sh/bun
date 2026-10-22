const codes = Array.prototype.map.call("ab", letter => letter.charCodeAt(0));
console.log(codes.length, codes[0] + 1, codes[1] + 1);
