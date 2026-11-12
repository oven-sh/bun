// RUN(UP): link
// UP: layout {{*}}{key="status"{{*}}]}] supertypes=[L

// RUN(BACK): link
// BACK: layout {{*}}fields=[{key="sent"{{*}}{key="setHeader"{{*}}]}] flags=

// `setHeader(): this` is one method and has one record, whichever type it is read off. What it returns in `Reply` says nothing of what an `Outgoing` is.
interface Outgoing {
  sent: boolean;
  setHeader(name: string): this;
}

interface Reply extends Outgoing {
  status: number;
}

declare const reply: Reply;
const road: { setHeader?: Outgoing["setHeader"] } = {};

const ofReply = reply.setHeader;
const ofOutgoing = road.setHeader!;
console.log(ofReply, ofOutgoing);

export function read(outgoing: Outgoing, other: Reply) {
  return outgoing.sent ? other.status : 0;
}
