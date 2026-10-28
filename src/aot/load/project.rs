use bun_sema::program::FileId;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum ProjectId {
    Application,
    Runtime,
}

impl ProjectId {
    pub const COUNT: usize = 2;
    pub const ALL: [ProjectId; ProjectId::COUNT] = [ProjectId::Application, ProjectId::Runtime];
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct ProgramFile {
    pub project: ProjectId,
    pub file: FileId,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct PerProject<T> {
    pub application: T,
    pub runtime: T,
}

impl<T> PerProject<T> {
    pub fn get(&self, project: ProjectId) -> &T {
        match project {
            ProjectId::Application => &self.application,
            ProjectId::Runtime => &self.runtime,
        }
    }

    pub fn as_ref(&self) -> PerProject<&T> {
        PerProject {
            application: &self.application,
            runtime: &self.runtime,
        }
    }

    pub fn map<U>(self, mut convert: impl FnMut(ProjectId, T) -> U) -> PerProject<U> {
        PerProject {
            application: convert(ProjectId::Application, self.application),
            runtime: convert(ProjectId::Runtime, self.runtime),
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = (ProjectId, &T)> + '_ {
        ProjectId::ALL
            .into_iter()
            .map(|project| (project, self.get(project)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_follows_declaration_order() {
        for (index, project) in ProjectId::ALL.into_iter().enumerate() {
            assert_eq!(project as usize, index);
        }
    }

    #[test]
    fn application_files_sort_before_runtime_files() {
        let application = ProgramFile {
            project: ProjectId::Application,
            file: FileId(9),
        };
        let runtime = ProgramFile {
            project: ProjectId::Runtime,
            file: FileId(0),
        };
        assert!(application < runtime);
    }

    #[test]
    fn map_and_iter_visit_both_projects_in_order() {
        let pair = PerProject {
            application: 1,
            runtime: 2,
        };
        let doubled = pair.map(|_, value| value * 2);
        let visited: Vec<_> = doubled
            .iter()
            .map(|(project, &value)| (project, value))
            .collect();
        assert_eq!(
            visited,
            [(ProjectId::Application, 2), (ProjectId::Runtime, 4)]
        );
        assert_eq!(*doubled.get(ProjectId::Runtime), 4);
    }
}
