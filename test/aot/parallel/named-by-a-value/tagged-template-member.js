class Tags { upper(parts) { return parts[0].toUpperCase(); } }
const tags = { lower(parts) { return parts[0].toLowerCase(); } };
console.log(new Tags().upper`abc`, tags.lower`DEF`);
