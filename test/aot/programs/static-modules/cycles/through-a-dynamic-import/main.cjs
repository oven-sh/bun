// The edge that closes the cycle is an import(): its target runs in a later job, when the body that asked for it has ended.
require("./a.cjs").loaded.then(saw => console.log(saw));
