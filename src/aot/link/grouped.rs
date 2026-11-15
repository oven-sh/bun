pub(super) struct Grouped<T> {
    pub items: Vec<T>,
    starts: Vec<u32>,
}

fn starts_of_groups(groups: &[u32], group_count: usize) -> Vec<u32> {
    let mut starts = vec![0u32; group_count + 1];
    for &group in groups {
        starts[group as usize + 1] += 1;
    }
    let mut count = 0;
    for start in &mut starts {
        count += *start;
        *start = count;
    }
    starts
}

impl<T: Copy> Grouped<T> {
    pub(super) fn new(items: &[T], groups: &[u32], group_count: usize) -> Grouped<T> {
        assert_eq!(items.len(), groups.len());
        let starts = starts_of_groups(groups, group_count);
        let mut next_places = starts.clone();
        let mut grouped = items.to_vec();
        for (&item, &group) in items.iter().zip(groups) {
            let place = &mut next_places[group as usize];
            grouped[*place as usize] = item;
            *place += 1;
        }
        Grouped {
            items: grouped,
            starts,
        }
    }

    pub(super) fn in_group(&self, group: usize) -> &[T] {
        &self.items[self.starts[group] as usize..self.starts[group + 1] as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn items_of_a_group_lie_in_a_row_in_their_order() {
        let grouped = Grouped::new(&['a', 'b', 'c', 'd'], &[2, 0, 2, 3], 5);
        let groups: Vec<&[char]> = (0..5).map(|group| grouped.in_group(group)).collect();
        assert_eq!(groups, [&['b'][..], &[], &['a', 'c'], &['d'], &[]]);
        assert_eq!(grouped.items, ['b', 'a', 'c', 'd']);
    }
}
