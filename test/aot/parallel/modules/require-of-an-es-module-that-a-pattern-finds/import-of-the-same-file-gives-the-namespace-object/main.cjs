const pick = name => require(`./pages/${name}.mjs`);
const page = pick(JSON.parse('"home"'));
import("./pages/home.mjs").then(all => {
  console.log(typeof page, typeof all, Object.keys(all).join(), all["module.exports"] === page);
});
