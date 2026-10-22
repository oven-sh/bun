import os from "node:os";
const user = os.userInfo();
console.log(typeof user.username, typeof user.uid, typeof user.homedir, typeof user.shell);
const interfaces = Object.values(os.networkInterfaces());
console.log(Array.isArray(interfaces[0]), typeof interfaces[0][0].address, typeof interfaces[0][0].internal, typeof interfaces[0][0].family);
