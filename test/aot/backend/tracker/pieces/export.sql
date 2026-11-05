-- Twenty issues with their labels and comments as one text, for the programs in this folder: psql -tA -f export.sql > issues.txt
-- An issue ends with chr(29), a record with chr(30), a field with chr(31). The first record of an issue is the issue, the second its
-- labels (id, name, color, ..), and every further one a comment. Times are milliseconds since 1970.
SELECT string_agg(
  concat_ws(chr(31), p.id, p.slug, p.name, p.description, i.id, i.number, i.title, i.state, i.priority, i.comment_count,
            (extract(epoch FROM i.created_at) * 1000)::bigint, (extract(epoch FROM i.updated_at) * 1000)::bigint,
            a.login, a.name, coalesce(s.login, ''), coalesce(s.name, ''), coalesce((extract(epoch FROM i.closed_at) * 1000)::bigint::text, ''), i.body)
  || chr(30) || coalesce((SELECT string_agg(concat_ws(chr(31), l.id, l.name, l.color), chr(31) ORDER BY l.name)
                          FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = i.id), '')
  || coalesce((SELECT string_agg(chr(30) || concat_ws(chr(31), c.id, coalesce(c.parent_id::text, ''), u.login, u.name,
                                                      (extract(epoch FROM c.created_at) * 1000)::bigint,
                                                      coalesce((extract(epoch FROM c.edited_at) * 1000)::bigint::text, ''), c.body), '' ORDER BY c.id)
               FROM comments c JOIN users u ON u.id = c.author_id WHERE c.issue_id = i.id), ''),
  chr(29) ORDER BY i.id)
FROM issues i JOIN projects p ON p.id = i.project_id JOIN users a ON a.id = i.author_id LEFT JOIN users s ON s.id = i.assignee_id
WHERE i.id % 1500 = 7;
