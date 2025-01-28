type IpType = "ipv4" | "ipv6";
type AddressLike = string; /* | net.SocketAddress */

const kHandle = Symbol("kHandle");
/** @todo */
type BlockListHandle = unknown;

/**
 * TODO: migrate this to native code
 * @see https://nodejs.org/api/net.html#class-netblocklist
 */
class BlockList {
  public static isBlockList(value: unknown): value is BlockList {
    return value?.[kHandle] !== undefined;
  }

  private [kHandle]: BlockListHandle;
  constructor() {
    // TODO
    this[kHandle] = kHandle;
  }

  public addAddress(net: AddressLike /* | net.SocketAddress */, type: IpType = "ipv4"): void {}
  public addRange(start: AddressLike, end: AddressLike, type: IpType = "ipv4"): void {}
  public addSubnet(subnet: AddressLike, prefix: number, type: IpType = "ipv4"): void {}
  public check(address: AddressLike, type: IpType = "ipv4"): boolean {
    return false;
  }

  get rules(): string[] {
    return [];
  }
}

export default {
  BlockList,
};
