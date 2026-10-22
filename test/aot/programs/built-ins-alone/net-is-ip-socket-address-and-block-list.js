import { BlockList, isIP, isIPv4, SocketAddress } from "node:net";
const address = new SocketAddress({ address: "127.0.0.1", port: 80 });
console.log(isIP("127.0.0.1") + 1, isIP("x"), isIPv4("::1"), address.address, address.port + 1, address.family, address.flowlabel + 1);
const list = new BlockList();
list.addAddress("10.0.0.1");
list.addRange("10.0.1.1", "10.0.1.9");
list.addSubnet("10.1.0.0", 16);
console.log(list.check("10.0.0.1"), list.check("10.0.1.5"), list.check("10.1.2.3"), list.check("8.8.8.8"), list.rules.length);
