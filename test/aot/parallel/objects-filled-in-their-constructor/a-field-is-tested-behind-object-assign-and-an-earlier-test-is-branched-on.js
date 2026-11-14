class Endpoint { constructor(given) { this.host = null; Object.assign(this, given); const secure = this.port === 443; const anonymous = this.host === null; this.url = (secure ? "https://" : "http://") + (anonymous ? "localhost" : this.host); } }
console.log(new Endpoint({ port: 443 }).url, new Endpoint({ host: "h", port: 80 }).url);
class Pair { constructor(given) { this.kept = 1; Object.assign(this, given); const wanted = this.wanted === 2, empty = this.kept === null; console.log(wanted ? 3 : 4, empty); } }
new Pair({ wanted: 2 });
new Pair({ kept: null });
