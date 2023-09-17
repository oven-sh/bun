import { Router } from "@kapsonfire/bun-bakery";

const PORT = 3000;
new Router({
  port: PORT,
  assetsPath: import.meta.dir + "/assets/",
  routesPath: import.meta.dir + "/routes/",
});

console.log(`Server running on port ${PORT}`);
