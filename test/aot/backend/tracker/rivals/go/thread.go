package main

import "sort"

// The comments of an issue, oldest first, as a forest: a reply hangs under the comment it answers.
func buildThread(comments []comment) []*commentNode {
	all := make([]commentNode, len(comments))
	nodes := make(map[int32]*commentNode, len(comments))
	roots := []*commentNode{}
	for i, c := range comments {
		node := &all[i]
		node.comment, node.Replies = c, []*commentNode{}
		nodes[c.ID] = node
		if c.ParentID != nil {
			if parent, found := nodes[*c.ParentID]; found {
				parent.Replies = append(parent.Replies, node)
				continue
			}
		}
		roots = append(roots, node)
	}
	return roots
}

// Who wrote the comments: the busiest first, then by login.
func participantsOf(comments []comment) []*participant {
	byLogin := make(map[string]*participant)
	list := []*participant{}
	for i := range comments {
		author := &comments[i].Author
		if known, found := byLogin[author.Login]; found {
			known.Comments++
		} else {
			added := &participant{userRef: *author, Comments: 1}
			byLogin[author.Login] = added
			list = append(list, added)
		}
	}
	sort.Slice(list, func(a, b int) bool {
		if list[a].Comments != list[b].Comments {
			return list[a].Comments > list[b].Comments
		}
		return list[a].Login < list[b].Login
	})
	return list
}
