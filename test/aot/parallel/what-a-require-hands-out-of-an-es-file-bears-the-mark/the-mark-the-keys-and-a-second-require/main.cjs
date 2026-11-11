const meadow = require("./meadow.mjs");
const { flower, water } = meadow;
console.log(flower, water(), Object.keys(meadow).join(), meadow.__esModule === undefined, require("./meadow.mjs") === meadow);
