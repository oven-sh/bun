// setBroadcast and setMulticastLoopback answer the operand as it came, an object too, and throw once the socket is closed.
const socket = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1" });
function broadcast(...flags) { return socket.setBroadcast(...flags); }
function loopback(...flags) { return socket.setMulticastLoopback(...flags); }
const held = { own: 1 };
for (const set of [broadcast, loopback])
  for (const flag of [true, false, 1, 0, "yes", "", null, undefined, 2n, held]) {
    try { const answer = set(flag); console.log(typeof answer, answer === flag); } catch (error) { console.log(error.code ?? error.name); }
  }
try { console.log(broadcast(held).own, typeof broadcast(), loopback(true, held, held), loopback(held, held).own); } catch (error) { console.log(error.code ?? error.name); }
class Holder { answer = socket.setBroadcast(held); }
try { console.log(new Holder().answer === held); } catch (error) { console.log(error.code ?? error.name); }
socket.close();
for (const set of [broadcast, loopback]) try { console.log(set(true)); } catch (error) { console.log(typeof error, error.code); }
