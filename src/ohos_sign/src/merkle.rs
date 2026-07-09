use crate::sha256;

const PAGE: usize = 4096;
const H: usize = 32;

/// Compute the fs-verity merkle tree root hash.
/// Matches upstream merkle_tree_builder.cpp::RunHashTask exactly:
/// - leaf pages are SHA-256(4KB page), last page zero-padded
/// - pages in [cs_off/PAGE, ceil((cs_off+cs_len)/PAGE)) get zero leaf hash
/// - upper layers: every 128 leaf hashes fill one page, re-hashed
/// - when current layer fits in one page it is zero-padded and hashed → root
pub fn root_hash(data: &[u8], cs_off: u64, cs_len: u64) -> [u8; H] {
    if data.is_empty() {
        let zeros = [0u8; PAGE];
        return sha256::hash(&zeros);
    }

    let npages = (data.len() + PAGE - 1) / PAGE;
    let cs_page_begin = (cs_off / PAGE as u64) as usize;
    let cs_page_end = if cs_len > 0 {
        ((cs_off + cs_len + PAGE as u64 - 1) / PAGE as u64) as usize
    } else {
        0
    };

    let mut cur: Vec<[u8; H]> = (0..npages)
        .map(|i| {
            if cs_len > 0 && i >= cs_page_begin && i < cs_page_end {
                [0u8; H]
            } else {
                let off = i * PAGE;
                let n = PAGE.min(data.len() - off);
                let mut page = [0u8; PAGE];
                page[..n].copy_from_slice(&data[off..off + n]);
                sha256::hash(&page)
            }
        })
        .collect();

    if cur.len() == 1 {
        return cur[0];
    }

    loop {
        let packed = cur.len() * H;
        if packed <= PAGE {
            let mut page = [0u8; PAGE];
            for (i, hash) in cur.iter().enumerate() {
                page[i * H..i * H + H].copy_from_slice(hash);
            }
            return sha256::hash(&page);
        }
        let next_pages = (packed + PAGE - 1) / PAGE;
        let mut next: Vec<[u8; H]> = Vec::with_capacity(next_pages);
        for i in 0..next_pages {
            let mut page = [0u8; PAGE];
            let off = i * PAGE / H;
            let count = (PAGE / H).min(cur.len() - off);
            for j in 0..count {
                page[j * H..j * H + H].copy_from_slice(&cur[off + j]);
            }
            next.push(sha256::hash(&page));
        }
        cur = next;
    }
}
