const READ = 1 << 0;
const WRITE = 1 << 1;
const EXEC = 1 << 2;
const ADMIN = READ | WRITE | EXEC;
const user = READ | EXEC;
const can = (p, flag) => (p & flag) === flag;
console.log(ADMIN, user, can(user, WRITE), can(user, EXEC), can(ADMIN, READ | WRITE), (user & ~EXEC).toString(2));
