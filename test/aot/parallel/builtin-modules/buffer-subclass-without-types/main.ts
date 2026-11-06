// A project without type declarations for `Buffer`: nothing declares the name, but Bun provides it, so the build goes on and the class extends it.
class Packet extends Buffer {
    tag(): string { return "a packet"; }
}
console.log(typeof Packet, Object.getPrototypeOf(Packet) === Buffer, Packet.prototype.tag.call(null));
