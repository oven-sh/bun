use bun_sema::program::FileId;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum ProjectId {
    Application,
    Runtime,
}

impl ProjectId {
    pub const COUNT: usize = 2;
    pub const ALL: [ProjectId; ProjectId::COUNT] = [ProjectId::Application, ProjectId::Runtime];

    pub fn index(self) -> usize {
        match self {
            ProjectId::Application => 0,
            ProjectId::Runtime => 1,
        }
    }
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

    pub fn get_mut(&mut self, project: ProjectId) -> &mut T {
        match project {
            ProjectId::Application => &mut self.application,
            ProjectId::Runtime => &mut self.runtime,
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
