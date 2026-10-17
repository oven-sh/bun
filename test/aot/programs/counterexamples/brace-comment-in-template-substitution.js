// A comment that holds `}` inside a substitution does not end the substitution.
console.log(String.raw`A${1 /* } */}B`);
