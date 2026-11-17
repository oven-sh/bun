use rustc_hash::FxHashMap;

use crate::types::{Comment, Participant};

/// The comments of an issue, oldest first, as a forest: a reply hangs under the comment it answers.
/// A reply is younger than what it answers, so from the youngest to the oldest every comment has all its replies when it is moved.
pub fn build_thread(comments: Vec<Comment>) -> Vec<Comment> {
    let places: FxHashMap<i32, usize> = comments.iter().enumerate().map(|(place, comment)| (comment.id, place)).collect();
    let mut nodes: Vec<Option<Comment>> = comments.into_iter().map(Some).collect();
    let mut roots = Vec::new();
    for place in (0..nodes.len()).rev() {
        let Some(mut node) = nodes[place].take() else { continue };
        node.replies.reverse();
        let parent = node.parent_id.and_then(|id| places.get(&id)).filter(|&&parent| parent < place);
        match parent.and_then(|&parent| nodes[parent].as_mut()) {
            Some(parent) => parent.replies.push(node),
            None => roots.push(node),
        }
    }
    roots.reverse();
    roots
}

/// Who wrote the comments: the busiest first, then by login.
pub fn participants_of(comments: &[Comment]) -> Vec<Participant> {
    let mut places: FxHashMap<&str, usize> = FxHashMap::default();
    let mut participants: Vec<Participant> = Vec::new();
    for Comment { author, .. } in comments {
        match places.get(author.login.as_str()) {
            Some(&place) => participants[place].comments += 1,
            None => {
                places.insert(&author.login, participants.len());
                participants.push(Participant { login: author.login.clone(), name: author.name.clone(), comments: 1 });
            }
        }
    }
    participants.sort_unstable_by(|a, b| b.comments.cmp(&a.comments).then_with(|| a.login.cmp(&b.login)));
    participants
}
