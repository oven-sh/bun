import domain from "domain-browser";

// domain-browser hands the "error" value of an added emitter to the domain as it is. Node replaces a falsy one.
const createDomainBrowser = domain.create;
domain.create = domain.createDomain = function () {
  const d = createDomainBrowser();
  function forward(er) {
    if (!er) {
      // https://github.com/nodejs/node/blob/b7e6a5d37e7a14ef0f2cc95214b95d66c4081415/lib/domain.js#L476-L478
      er = new Error("Unhandled error.");
      er.code = "ERR_UNHANDLED_ERROR";
    }
    d.emit("error", er);
  }
  d.add = function (emitter) {
    emitter.on("error", forward);
  };
  d.remove = function (emitter) {
    emitter.removeListener("error", forward);
  };
  return d;
};

export var { create, createDomain } = domain;
