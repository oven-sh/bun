const raw = process.env.APP_CONFIG ?? "{";
const config = {};
try {
  config.user = JSON.parse(raw);
} catch (err) {
  config.error = err;
}
export function port() {
  return config.user?.port ?? 8080;
}
console.log(port() === 8080 ? "default" : "other", port() === 8080 ? "default" : "other");
