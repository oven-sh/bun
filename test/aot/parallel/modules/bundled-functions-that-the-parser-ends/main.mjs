// The last line of what bun build --format=cjs writes may begin with // inside of a template, and comments may follow it.
import footer from "./footer.cjs";
import harbor from "./harbor.cjs";

console.log(harbor.note("east"), harbor.last.join(), footer.value);
