const isDev = false;
const R = new Date(isDev ? 0 : 86400000).toISOString();
console.log(R);
