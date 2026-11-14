// A text that is the front of a longer string is parsed where it lies, so what follows it in memory is the rest of that string.
const documents = [
  '[{"k":"x}y"},1]',
  '{"a":[1,2,{"b":"c]d"}],"e}f":{"g]":"\\u00e9}"},"h":12.5}',
  '[[],{},[{}],{"a":[]},"]","}",tru,true]',
  '{"a":1,"b":[10,-20,3.25e2,"s]"],"c":{"d":null,"e":false}}}]',
  ' [ { "name" : "first }" , "at" : [ 1 , 2 ] } , { "name" : "second ]" , "at" : [ ] } ] ',
  '[{"long":"' + "0123456789abcde}".repeat(20) + '"},{"long":"' + "0123456789abcde}".repeat(20) + '"}]',
  '["}\\u007d]","\\"}\\\\]","\\u12}4"]',
  '{"}":1,"]":{"}":2},"a}b":[3]}',
  "[123456789,1234567890123456789,0.12345678901234567]9]",
];
const summary = (value: any): string => {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch (error: any) {
    return error.name;
  }
};
for (const document of documents) {
  const ends: string[] = [];
  let errors = 0;
  for (let end = 0; end <= document.length; end++) {
    for (let start = 0; start < Math.min(end, 3); start++) {
      const result = summary(document.substring(start, end));
      if (result === "SyntaxError") errors++;
      else ends.push(`${start}..${end} ${result.length > 60 ? result.length : result}`);
    }
  }
  console.log(errors, ends.join(" | "));
}
// The same texts as their own strings, and with whitespace that is none of JSON's behind them.
let same = 0;
for (const document of documents) {
  for (let end = 0; end <= document.length; end++) {
    const part = document.substring(0, end);
    const own = part.split("").join("");
    same += +(summary(part) === summary(own));
    same += +(summary(part + " ") === "SyntaxError");
    same += +(summary(part + " \n\t\r ") === summary(own));
  }
}
console.log(same, documents.reduce((sum, document) => sum + 3 * (document.length + 1), 0));
