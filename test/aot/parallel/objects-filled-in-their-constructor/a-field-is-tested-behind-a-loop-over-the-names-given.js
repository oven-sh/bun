class Endpoint { constructor(given) { this.host = null; for (const name in given) this[name] = given[name]; const secure = this.port === 443; const anonymous = this.host === null; this.url = (secure ? "https://" : "http://") + (anonymous ? "localhost" : this.host); } }
console.log(new Endpoint({ port: 443 }).url, new Endpoint({ host: "h" }).url);
function Old(given) { this.host = null; Object.assign(this, given); const secure = this.port === 443; const anonymous = this.host === null; this.url = (secure ? "https://" : "http://") + (anonymous ? "localhost" : this.host); }
console.log(new Old({ port: 443 }).url, new Old({ host: "h", port: 80 }).url);
