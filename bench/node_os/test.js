const os = require("node:os");

for (let i = 0; i < 10; i++) {
    console.log(os.cpus());
}
