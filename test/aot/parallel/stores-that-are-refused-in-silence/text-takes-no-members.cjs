const text = String("abc");
text.own = 1; text[0] = "x"; text.length = 9;
console.log(text.own, text[0], text.length);
