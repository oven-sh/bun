import { SQL } from "bun";

process.env.DATABASE_URL = "foo_url";

const client = new SQL({
    hostname: "bar_url",
    username: "postgres",
    password: "postgres",
    port: 5432,
});

console.log("hostname:", client.options.hostname);
console.log("port:", client.options.port);
console.log("username:", client.options.username);

// Expected: hostname should be "bar_url", not from DATABASE_URL
if (client.options.hostname === "bar_url") {
    console.log("✅ PASS: hostname correctly uses explicit option, not DATABASE_URL");
} else {
    console.log("❌ FAIL: hostname incorrectly uses DATABASE_URL instead of explicit option");
    process.exit(1);
}

if (client.options.port === 5432) {
    console.log("✅ PASS: port correctly uses explicit option");
} else {
    console.log("❌ FAIL: port doesn't use explicit option");
    process.exit(1);
}

if (client.options.username === "postgres") {
    console.log("✅ PASS: username correctly uses explicit option");  
} else {
    console.log("❌ FAIL: username doesn't use explicit option");
    process.exit(1);
}

console.log("🎉 All tests passed! Issue #22147 is fixed!");