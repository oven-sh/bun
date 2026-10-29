const url = new URL("./beside.js", import.meta.url).href;
console.log(url.slice(url.indexOf("%7E")));
export const start = () =>
  new Worker(
    "data:text/javascript," +
      encodeURIComponent('import("' + url + '").then(it => postMessage(it.beside), () => postMessage("refused"))'),
  );
