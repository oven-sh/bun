import axios from "axios";

const res = await axios.get("http://127.0.0.1:8080/status/400");

console.log(res.statusText);

/*
- network issue (example is axios.ts file)
- disabling?
- when should the red line disappear? Immediately once the user starts typing again? (perhaps only on --watch)
- Test how this works with cursor
- bun should be timing out if cannot connect to socket

side notes:
- publishing bun-adapter-protocol etc to npm
- how does this work with Bake? Should i be working with Bake side of things
*/

// - disable debugger
