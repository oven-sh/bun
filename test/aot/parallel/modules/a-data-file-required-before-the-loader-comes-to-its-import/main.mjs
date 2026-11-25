// The loader takes what main.mjs imports level by level, and a CommonJS file runs where the loader comes to it. What stands six levels down is not loaded by then:
// require() parses the file itself and answers the value, not the namespace object of an ES module. That answer stays, for every file that requires it later.
// `bun <file>` prints another output in about one run of sixty: the threads of its transpiler have come six levels down by then. The output that it prints otherwise stands here.
import { again } from "./early.cjs";
import "./level-1.mjs";
again();

/* Output:
json: host,port
a list: a list of 2,4,6
toml: host,port
of a package: host,port
read by name: host,port
through another CommonJS file: host,port
stored: 8080 8080
imported: localhost 3 localhost localhost 3000 localhost
json, later: host,port
a list, later: a list of 2,4,6
the same object: true 8080
*/
