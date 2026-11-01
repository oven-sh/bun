exports.startWithCommonJsNames = ask => [
  ["__filename", __filename, ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + __filename + "`.match(/[\\\\/][^\\\\/]*$/)[0])")))],
  ["__dirname", __dirname, ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + __dirname + "`.match(/[\\\\/](?=[^\\\\/]*$)/)[0]);3")))],
];
