// Each of these differs in one step from the functions that bind every name of another module to the exports: the module keeps its object, and a name is read by a property access. Nothing but names is read of them here, so that nothing else makes them keep it.
// IR+ (PropGet v[0-9]+|CallMethod v[0-9]+ \(.*\)) name="alpha"
// IR+ (PropGet v[0-9]+|CallMethod v[0-9]+ \(.*\)) name="beta"
// IR+ (PropGet v[0-9]+|CallMethod v[0-9]+ \(.*\)) name="gamma"
// IR+ (PropGet v[0-9]+|CallMethod v[0-9]+ \(.*\)) name="delta"
// IR+ (PropGet v[0-9]+|CallMethod v[0-9]+ \(.*\)) name="epsilon"
// IR+ (PropGet v[0-9]+|CallMethod v[0-9]+ \(.*\)) name="zeta"
// IR+ (PropGet v[0-9]+|CallMethod v[0-9]+ \(.*\)) name="eta"
// IR+ (PropGet v[0-9]+|CallMethod v[0-9]+ \(.*\)) name="theta"
// IR+ (PropGet v[0-9]+|CallMethod v[0-9]+ \(.*\)) name="iota"
const alphaModule = require("./files/default-too.js");
console.log(typeof alphaModule.alpha === "function" ? alphaModule.alpha() : alphaModule.alpha, alphaModule.alphaValue);
const betaModule = require("./files/what-is-there-is-overwritten.js");
console.log(typeof betaModule.beta === "function" ? betaModule.beta() : betaModule.beta, betaModule.betaValue);
const gammaModule = require("./files/values-are-copied.js");
console.log(typeof gammaModule.gamma === "function" ? gammaModule.gamma() : gammaModule.gamma, gammaModule.gammaValue);
const deltaModule = require("./files/not-enumerable.js");
console.log(typeof deltaModule.delta === "function" ? deltaModule.delta() : deltaModule.delta, deltaModule.deltaValue);
const epsilonModule = require("./files/under-another-name.js");
console.log(typeof epsilonModule.epsilon === "function" ? epsilonModule.epsilon() : epsilonModule.epsilon, epsilonModule.epsilonValue);
const zetaModule = require("./files/the-function-is-stored-to.js");
console.log(typeof zetaModule.zeta === "function" ? zetaModule.zeta() : zetaModule.zeta, zetaModule.zetaValue);
const etaModule = require("./files/unless-something-else-has-one.js");
console.log(typeof etaModule.eta === "function" ? etaModule.eta() : etaModule.eta, etaModule.etaValue);
const thetaModule = require("./files/one-statement-more.js");
console.log(typeof thetaModule.theta === "function" ? thetaModule.theta() : thetaModule.theta, thetaModule.thetaValue);
const iotaModule = require("./files/the-other-way-round.js");
console.log(typeof iotaModule.iota === "function" ? iotaModule.iota() : iotaModule.iota, iotaModule.iotaValue);
