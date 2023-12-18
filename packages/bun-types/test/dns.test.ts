import * as dns from "node:dns";

dns.resolve("asdf", "A", () => {});
dns.reverse("asdf", () => {});
dns.getServers();
