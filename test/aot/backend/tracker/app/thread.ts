import type { Comment, CommentNode, Participant } from "./types";

/** The comments of an issue, oldest first, as a forest: a reply hangs under the comment it answers. */
export function buildThread(comments: Comment[]): CommentNode[] {
  const nodes = new Map<number, CommentNode>();
  const roots: CommentNode[] = [];
  for (const comment of comments) {
    const node: CommentNode = { ...comment, replies: [] };
    nodes.set(node.id, node);
    const parent = comment.parentId === null ? undefined : nodes.get(comment.parentId);
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Who wrote the comments: the busiest first, then by login. */
export function participantsOf(comments: Comment[]): Participant[] {
  const participants = new Map<string, Participant>();
  for (const { author } of comments) {
    const participant = participants.get(author.login);
    if (participant) participant.comments++;
    else participants.set(author.login, { login: author.login, name: author.name, comments: 1 });
  }
  return [...participants.values()].sort((a, b) => b.comments - a.comments || (a.login < b.login ? -1 : 1));
}
