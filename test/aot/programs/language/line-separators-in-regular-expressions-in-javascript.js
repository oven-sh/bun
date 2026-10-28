// U+2028 stands in the first regular expression and U+2029, behind a backslash, in the second. Both end a line, and a regular expression ends on the line where it starts.
console.log(/a b/.source.length);
console.log(/a\ b/.source.length);
